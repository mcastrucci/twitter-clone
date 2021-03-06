document.addEventListener("DOMContentLoaded", (event)=>{
    const url = "/getFollowersSugestion"
    const request = new Request(url, {
        headers: new Headers({
        'Content-Type': 'application/json'
    })})
        
    fetch(request)
    .then(result => result.json())
    .then(response => {
        console.log(response.users);
        addPeopleToFollow(response.users);
    }).catch((err)=>{
        console.log("failed to get followers");
    })
    const feedUrl = "/get-tweets"

    
    const feedRequest = new Request(feedUrl, {
        headers: new Headers({
        'Content-Type': 'application/json'
    })})
        
    fetch(feedRequest)
    .then(result => result.json())
    .then(response => {
        console.log(response.response);
        addTweetToDashboard(response.response);
    }).catch((err)=>{
        console.log("failed to get tweets");
    })

    const addTweetToDashboard = (tweets) => {
        let template = document.querySelector(".tweet-card-template");
        let tweet_container = document.querySelector(".tweets--container");
        let element = template.content.querySelector(".tweet__card");

        for (let tweet of tweets){ 
            let a = element.cloneNode(true);
            let name = a.querySelector(".tweet__card__tweet__name");
            let message = a.querySelector(".tweet__card__tweet_message");

            name.innerHTML = `${tweet.author} - ${tweet.timeString} ago`;
            message.innerHTML = tweet.message;
            tweet_container.appendChild(a);    
        }
    }

    
    const addPeopleToFollow = (users) => {
        let template = document.querySelector(".people-to-follow-template");
        let right_panel = document.querySelector(".people_to_follow--container");
        let element = template.content.querySelector(".people-to-follow--card");
        
        for (let user of users){ 
            let a = element.cloneNode(true);
            let text = a.querySelector(".people-to-follow-name");
            let followButton = a.querySelector(".follow-button");
            followButton.setAttribute("data-username", user);
            followButton.addEventListener("click", followUser);
            text.innerHTML = user;
            right_panel.appendChild(a);    
        }
    }

    const followUser = (event) => {
        let userToFollow = event.target.getAttribute('data-username');

        let url = "/follow"
        const options = {
            method: 'post',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({userToFollow: userToFollow})
        }
            
        try {
            fetch(url, options)
            .then(result => result.json())
            .then(response => {
                showError(response.response);
                location.reload();
                false;
            }).catch((err) => {
                showError(err);
            })
        } 
        catch(err) {
            showError(err);
        }
    }

    const showError = (error) => {
        let modal = document.querySelector(".error-modal").classList.remove("hidden")
        let text = document.querySelector(".error-modal--text");
        text.innerHTML = error;
        setTimeout (()=>{
            document.querySelector(".error-modal").classList.add("hidden");
        },10000);
    }
})