#!/bin/bash
#Author: Derrick S K Siawor
#Company: Derk Online © Copyright 2017 - 2022

#This script checks the Derk Online servers for an update for CeyMail every 12 hours

checkUpdate(){
    mkdir -p ~/ceymail-update
    cd ~/ceymail-update
    wget --quiet https://cloud.derkonline.com/s/BYnw7mQSC4ZgGMf/download/ceymail.zip
    unzip -q ceymail.zip
    rm ceymail.zip install
    newCMHash=($(md5sum ceymail))
    oldCMHash=($(md5sum /ceymail/ceymail))

    if [[ $newCMHash == $oldCMHash ]]; then
        echo ""
        echo "Checking CeyMail servers for latest updates..."
        sleep 2s
        printf "You are using the latest version of CeyMail.\nPlease check back again for updates at a later time."
        echo ""
        sleep 1s
        cd ..
        rm -rf ~/ceymail-update

    elif [[ $newCMHash != $oldCMHash ]]; then
        echo ""
        echo "Checking CeyMail servers for latest updates..."
        sleep 1s
        echo "Downloading latest CeyMail update from the cloud..."
        sleep 2s
        echo "Updating CeyMail..."
        sleep 2s
        mv ceymail /ceymail
        echo "CeyMail has been updated!"
        echo "Please run CeyMail again."
        sleep 1s
        mv update /ceymail/update
	    dos2unix /ceymail/ceymail /ceymail/update >/dev/null 2>&1 && chmod +x -R /ceymail
        cd ..
        rm -rf ~/ceymail-update
        exit 0
    else 
        cd ..
        rm -rf ~/ceymail-update
        echo ""
        echo "Something went wrong. Try again later."

    fi
    
}

checkUpdate
return